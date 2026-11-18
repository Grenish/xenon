import config from "@/xenon.config";
import { createApiHandler } from "xenon-cms/next";

export const { GET, POST, PATCH, DELETE } = createApiHandler(config);
