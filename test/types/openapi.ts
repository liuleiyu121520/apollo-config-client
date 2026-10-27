import { remoteConfigService, type ApolloOpenApiOptions } from '../../dist';

const withoutNamespace: ApolloOpenApiOptions = {
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  clusterName: 'default',
  apolloEnv: 'dev',
  token: 'openapi-token',
};

const withNamespace: ApolloOpenApiOptions = {
  ...withoutNamespace,
  namespaceName: 'application',
};

void remoteConfigService(withoutNamespace);
void remoteConfigService(withNamespace);

// appId and clusterName remain required by the public OpenApi contract.
// @ts-expect-error appId is required
void remoteConfigService({
  configServerUrl: 'http://apollo.example.com',
  clusterName: 'default',
  apolloEnv: 'dev',
  token: 'openapi-token',
});

// @ts-expect-error clusterName is required
void remoteConfigService({
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  apolloEnv: 'dev',
  token: 'openapi-token',
});

// @ts-expect-error token is required by the OpenApi runtime contract
void remoteConfigService({
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  clusterName: 'default',
  apolloEnv: 'dev',
});

// @ts-expect-error configServerUrl is required by the OpenApi runtime contract
void remoteConfigService({
  appId: 'sample-app',
  clusterName: 'default',
  apolloEnv: 'dev',
  token: 'openapi-token',
});
