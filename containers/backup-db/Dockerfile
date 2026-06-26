FROM alpine
RUN apk add --no-cache postgresql18-client
COPY --chmod=755 ./backup.sh /usr/src/app/

RUN echo '0 4 * * *    /usr/src/app/backup.sh' >> /etc/crontabs/root

CMD ["crond", "-l", "2", "-f"]