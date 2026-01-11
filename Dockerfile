FROM node:25-alpine AS app
WORKDIR /usr/src/app
RUN apk add --no-cache tzdata
ENV TZ=America/Toronto
COPY package*.json tsconfig.json ./
COPY src src
COPY sql sql
RUN npm install

EXPOSE 3000
CMD ["npm", "start"]