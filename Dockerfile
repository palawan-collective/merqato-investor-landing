FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /app/data /app/uploads
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
