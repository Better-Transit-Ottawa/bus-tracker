CREATE TABLE IF NOT EXISTS blocks (
    gtfs_version NUMERIC,
    route_id TEXT,
    service_id TEXT,
    trip_id TEXT,
    trip_headsign TEXT,
    route_direction INT,
    block_id TEXT,
    shape_id TEXT,
    start_time INTERVAL,
    end_time INTERVAL,
    PRIMARY KEY (gtfs_version, trip_id)
);

CREATE TABLE IF NOT EXISTS gtfs_versions (
    version NUMERIC PRIMARY KEY,
    import_date DATE
);

CREATE TABLE IF NOT EXISTS vehicles (
    time TIMESTAMP,
    id TEXT,
    trip_id TEXT,
    delay_min DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    recorded_timestamp INTERVAL,
    next_stop_id TEXT,
    PRIMARY KEY (time, id)
);

CREATE TABLE IF NOT EXISTS canceled (
    time TIMESTAMP,
    date DATE,
    trip_id TEXT,
    schedule_relationship INTEGER,
    PRIMARY KEY (date, trip_id)
);

CREATE TABLE IF NOT EXISTS stops (
    gtfs_version NUMERIC,
    trip_id TEXT,
    stop_id TEXT,
    arrival_time INTERVAL,
    departure_time INTERVAL,
    stop_sequence INT,
    distance_traveled DOUBLE PRECISION,
    timepoint INT,
    PRIMARY KEY (gtfs_version, trip_id, stop_id, stop_sequence)
);

CREATE TABLE IF NOT EXISTS stop_info (
    gtfs_version NUMERIC,
    stop_id TEXT,
    stop_code TEXT,
    stop_name TEXT,
    stop_desc TEXT,
    stop_lat DOUBLE PRECISION,
    stop_lon DOUBLE PRECISION,
    zone_id TEXT,
    stop_url TEXT,
    location_type INT,
    parent_station TEXT,
    stop_timezone TEXT,
    wheelchair_boarding INT,
    PRIMARY KEY (gtfs_version, stop_id)
);

CREATE TABLE IF NOT EXISTS shapes (
    gtfs_version NUMERIC,
    shape_id TEXT,
    shape_pt_lat DOUBLE PRECISION,
    shape_pt_lon DOUBLE PRECISION,
    shape_pt_sequence INT,
    shape_dist_traveled DOUBLE PRECISION,
    PRIMARY KEY (gtfs_version, shape_id, shape_pt_sequence)
);

CREATE TABLE IF NOT EXISTS block_data (
    date DATE,
    trip_id TEXT,
    bus_id TEXT,
    block_id TEXT,
    route_id TEXT,
    route_direction INT,
    start_time INTERVAL,
    scheduled_start_time INTERVAL,
    PRIMARY KEY (date, trip_id)
);

CREATE TABLE IF NOT EXISTS calendar (
    gtfs_version NUMERIC,
    service_id TEXT,
    monday INT,
    tuesday INT,
    wednesday INT,
    thursday INT,
    friday INT,
    saturday INT,
    sunday INT,
    start_date DATE,
    end_date DATE
);

CREATE TABLE IF NOT EXISTS calendar_dates (
    gtfs_version NUMERIC,
    service_id TEXT,
    date DATE,
    exception_type INT,
    PRIMARY KEY (gtfs_version, service_id, date)
);

CREATE TABLE IF NOT EXISTS cache_on_time_daily (
    service_date DATE NOT NULL,
    metric VARCHAR(20) NOT NULL,
    threshold_minutes INT NOT NULL,
    include_canceled BOOLEAN NOT NULL,
    frequency_filter VARCHAR(20) NOT NULL,
    route_id VARCHAR(20) NOT NULL,
    data JSONB NOT NULL,
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (service_date, metric, threshold_minutes, include_canceled, frequency_filter, route_id)
);

CREATE TABLE IF NOT EXISTS cache_bus_count (
    service_date DATE NOT NULL,
    time INTERVAL NOT NULL,
    active_buses NUMERIC NOT NULL,
    buses_on_routes NUMERIC NOT NULL,
    trips_scheduled NUMERIC NOT NULL,
    trips_not_running NUMERIC NOT NULL,
    trips_never_ran NUMERIC NOT NULL,
    trips_canceled NUMERIC NOT NULL,
    trips_still_running NUMERIC NOT NULL,
    PRIMARY KEY (service_date, time)
);

CREATE INDEX IF NOT EXISTS vehicles_trip_id ON vehicles (trip_id);
CREATE INDEX IF NOT EXISTS vehicles_time ON vehicles (time);
CREATE INDEX IF NOT EXISTS vehicles_trip_id_time ON vehicles (trip_id, time);
CREATE INDEX IF NOT EXISTS vehicles_id ON vehicles (id);

CREATE INDEX IF NOT EXISTS blocks_block_id ON blocks (block_id);
CREATE INDEX IF NOT EXISTS blocks_start_time ON blocks (start_time);
CREATE INDEX IF NOT EXISTS blocks_version ON blocks (gtfs_version, service_id);
CREATE INDEX IF NOT EXISTS blocks_version_block
ON blocks (gtfs_version, service_id, block_id);
CREATE INDEX IF NOT EXISTS blocks_version_route
ON blocks (gtfs_version, service_id, route_id);
CREATE INDEX IF NOT EXISTS blocks_trip_block_id ON blocks (trip_id, block_id);

CREATE INDEX IF NOT EXISTS blocks_data_route ON blocks (route_id);

CREATE INDEX IF NOT EXISTS stops_arrival_time ON stops (trip_id, arrival_time);

CREATE INDEX IF NOT EXISTS block_data_date_block_bus
ON block_data (date, block_id, bus_id);

CREATE INDEX IF NOT EXISTS idx_cache_on_time_daily_date
ON cache_on_time_daily (service_date);
