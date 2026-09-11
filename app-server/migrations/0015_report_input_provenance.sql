-- Pin immutable raw S3 versions and checksums before a report worker is invoked.
alter table analysis_report_inputs add column object_key text;
alter table analysis_report_inputs add column object_version_id text;
alter table analysis_report_inputs add column object_checksum_sha256 text;
