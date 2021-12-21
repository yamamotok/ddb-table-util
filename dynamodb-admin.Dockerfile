FROM node:12

RUN npm install -g dynamodb-admin

CMD ["dynamodb-admin"]
