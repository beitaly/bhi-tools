FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# Install Playwright Chromium browser
RUN npx playwright install chromium --with-deps

COPY . .

EXPOSE 3000

CMD ["node", "scraper.js"]
