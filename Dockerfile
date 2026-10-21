FROM node:26-alpine AS app
WORKDIR /usr/src/app
RUN apk add --no-cache tzdata
ENV TZ=America/Toronto
COPY package*.json tsconfig.json ./
RUN npm install
COPY src src
COPY sql sql

EXPOSE 3000
CMD ["npm", "start"]