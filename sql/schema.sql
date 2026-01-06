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

CREATE INDEX IF NOT EXISTS vehicles_trip_id ON vehicles (trip_id);
CREATE INDEX IF NOT EXISTS vehicles_time ON vehicles (time);
CREATE INDEX IF NOT EXISTS vehicles_trip_id_time ON vehicles (trip_id, time);

CREATE INDEX IF NOT EXISTS blocks_block_id ON blocks (block_id);
CREATE INDEX IF NOT EXISTS blocks_start_time ON blocks (start_time);