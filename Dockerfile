FROM node:25-alpine AS app
WORKDIR /usr/src/app
COPY package*.json tsconfig.json ./
COPY src src
COPY sql sql
RUN npm install

EXPOSE 3000
CMD ["npm", "start"]