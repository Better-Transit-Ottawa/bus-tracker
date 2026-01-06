FROM node:25-alpine AS app
WORKDIR /usr/src/app
COPY package.json package-lock.json tsconfig.json ./
COPY src src
COPY node_modules ./node_modules
COPY config.json config.json

EXPOSE 3000
CMD ["npm", "start"]