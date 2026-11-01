// One Vite runner shares a module graph for the actual isolated service composition.
export * as persistence from '../../../apps/realm/src/persistence/index';
export * as allocation from '../../../apps/realm/src/allocation/index';
export * as bootstrap from '../../../apps/realm/src/bootstrap/index';
export * as wiring from '../../../apps/realm/src/wiring/index';
export * as evening from '../../../apps/realm/src/evening/index';
export * as citizens from '../../../apps/realm/src/evening/citizens';
export * as castle from '../../../apps/realm/src/evening/castle';
export * as interactions from '../../../apps/realm/src/evening/interactions';
export * as dock from '../../../apps/realm/src/dock/index';
export * as world from '../../../packages/world/src/index';
export * as authService from '../../../apps/api/src/realm-auth/service';
export * as authHttp from '../../../apps/api/src/realm-auth/http';
export * as simulatedOidc from '../../../apps/api/src/realm-auth/simulated-provider';
export * as dockApi from '../../../apps/api/src/dock/index';
