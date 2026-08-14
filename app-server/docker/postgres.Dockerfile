FROM postgres:16-alpine

RUN apk add --no-cache aws-cli python3
COPY app-server/docker/postgres-entrypoint.sh /usr/local/bin/wally-postgres-entrypoint
RUN chmod 0555 /usr/local/bin/wally-postgres-entrypoint
ENTRYPOINT ["/usr/local/bin/wally-postgres-entrypoint"]
CMD ["postgres"]
