import { expose } from "comlink";
import { createClusterWorkerApi } from "./worker-api.ts";

expose(createClusterWorkerApi());
