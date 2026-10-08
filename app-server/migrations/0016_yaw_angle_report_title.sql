-- Keep the stable definition key for request and artifact compatibility while changing
-- the global customer-facing report title for both new selections and report history.
update report_definitions
set display_name = 'Yaw Angle Report'
where key = 'tracking-error';
