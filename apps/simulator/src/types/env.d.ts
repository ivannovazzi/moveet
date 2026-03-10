declare namespace NodeJS {
  interface ProcessEnv {
    PORT: string;
    MIN_SPEED: string;
    MAX_SPEED: string;
    SPEED_VARIATION: string;
    HEATZONE_SPEED_FACTOR: string;
    ACCELERATION: string;
    DECELERATION: string;
    TURN_THRESHOLD: string;
    UPDATE_INTERVAL: string;
    GEOJSON_PATH: string;
    ADAPTER_URL: string;
    SYNC_ADAPTER_TIMEOUT: string;
  }
}
