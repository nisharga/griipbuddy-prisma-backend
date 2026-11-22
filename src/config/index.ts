// Config entry point: environment variables (./env) + fixed app settings (./appConfigs).
import { env } from "./env";

export * from "./env";
export * from "./appConfigs";

// `import config from "@/config"` → the environment config.
export default env;
