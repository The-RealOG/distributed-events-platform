import { GenericContainer, Wait } from 'testcontainers';

/**
 * S3-compatible storage for tests: LocalStack's S3 (pinned). It implements presigned POST
 * policies (content-length-range, eq conditions) like S3. MinIO's community images are no
 * longer published on Docker Hub.
 */
export const S3_IMAGE = 'localstack/localstack:4.14.0';

export interface StartedS3 {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  stop(): Promise<void>;
}

export async function startS3(): Promise<StartedS3> {
  const container = await new GenericContainer(S3_IMAGE)
    .withEnvironment({ SERVICES: 's3', EAGER_SERVICE_LOADING: '1' })
    .withExposedPorts(4566)
    .withWaitStrategy(Wait.forHttp('/_localstack/health', 4566).forStatusCode(200))
    .withStartupTimeout(180_000)
    .start();
  return {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(4566)}`,
    accessKeyId: 'test',
    secretAccessKey: 'test',
    region: 'us-east-1',
    stop: async () => {
      await container.stop();
    },
  };
}
