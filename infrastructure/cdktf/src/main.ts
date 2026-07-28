import { App } from 'cdktf';
import { loadEnvironmentConfig } from './config';
import { ProvePresentStack } from './prove-present-stack';

const app = new App();

for (const environment of ['dev', 'staging', 'prod'] as const) {
  const config = loadEnvironmentConfig(environment);
  if (!config) {
    continue;
  }
  new ProvePresentStack(app, environment, config);
}

app.synth();
