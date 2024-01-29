
FROM node:16-slim AS build
WORKDIR /app
RUN apt update && apt -y install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev imagemagick file ghostscript poppler-utils img2pdf && rm -rf /var/lib/apt/lists/*
ADD package.json yarn.lock ./
RUN yarn --ignore-optional --prod --frozen-lockfile
COPY src src
COPY font font

FROM build AS test
RUN yarn --frozen-lockfile
# fail if needs linting
ADD .eslintrc.yml .
RUN yarn eslint src
# fail if unit tests fail
RUN yarn jest --coverage --color
# fail if any vulnerabilities >= moderate
# RUN yarn audit --groups dependencies --level moderate || test $? -le 2

FROM build AS prod
LABEL com.bookawardpro.tags "api,bunyan"
ENV NODE_ENV production
# trust ssl certs signed by hosting providers (eg DigitalOcean)
ADD ca.crt .
ENV NODE_EXTRA_CA_CERTS /app/ca.crt
ENV PATH "/app/src/bin:/app/node_modules/.bin:$PATH"
CMD ["src"]
USER node
