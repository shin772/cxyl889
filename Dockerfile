FROM node:22-slim
LABEL "language"="nodejs"
LABEL "framework"="express"

WORKDIR /src

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p public/uploads

EXPOSE 8080

CMD ["node", "server.js"]
