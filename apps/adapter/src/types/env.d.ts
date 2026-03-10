declare namespace NodeJS {
  interface ProcessEnv {
    PORT?: string;
    SOURCE_TYPE?: string;
    SOURCE_CONFIG?: string;
    SINK_TYPES?: string;
    [key: `SINK_${string}_CONFIG`]: string | undefined;
  }
}
