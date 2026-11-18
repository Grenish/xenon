import { memoryAdapter } from "../../src/adapters/memory";
import { runDatabaseAdapterConformance } from "./conformance";

runDatabaseAdapterConformance("memory", async () => memoryAdapter());
