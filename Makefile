
.DEFAULT_GOAL := help

SHELL := /bin/bash

NAME := cotton
VERSION := $(shell awk -F '[ ":]+' '$$2 == "version" { print $$3 }' package.json)
MAINTAINER := erik@bookawardpro.com

NODE_BIN := node_modules/.bin
DOCKER_REPO := registry.gitlab.com/bookawardpro/pkg
DOCKER_TAG := $(DOCKER_REPO)/$(NAME):$(VERSION)


.PHONY:
help: ## show target summary
	@grep -E '^\S+:.* ## .+$$' $(MAKEFILE_LIST) | sed 's/##/#/' | while IFS='#' read spec help; do \
	  tgt=$${spec%%:*}; \
	  printf "\n%s: %s\n" "$$tgt" "$$help"; \
	  awk -F ': ' -v TGT="$$tgt" '$$1 == TGT && $$2 ~ "=" { print $$2 }' $(MAKEFILE_LIST) | \
	  while IFS='#' read var help; do \
	    printf "  %s  :%s\n" "$$var" "$$help"; \
	  done \
	done


node_modules: package.json ## install dependencies
	yarn install
	touch node_modules


.PHONY:
dev: node_modules ## start server
	$(NODE_BIN)/nodemon -r dotenv/config src | bunyan -o short


.PHONY:
lint: node_modules ## static code check (eg syntax errors, unused vars)
	yarn eslint --fix --format unix src

.PHONY:
audit: node_modules ## check dependencies for vulnerabilities
	yarn audit --groups dependencies --level moderate || test $? -le 2

.PHONY:
test: ## run unit tests
ifeq ($(shell which yarn),)
# dev tooling not installed, so run tests in container
	docker build --target=test -t $(NAME):test .
else
	yarn jest --coverage --color
endif

.PHONY:
test-email: EMAILS?=# specific email(s) to test - leave empty to test all
test-email: ## send test emails
	node -r dotenv/config src/bin/test-email.js -v info $(EMAILS) | bunyan -o short


.PHONY:
build: ## build docker image
	docker build --target=prod -t $(NAME) .

.PHONY:
publish: ## publish docker image to repo
	docker tag $(NAME) $(DOCKER_TAG)
	docker push $(DOCKER_TAG)


.PHONY:
targets: IDS?=# specific subscription ids to process - leave empty for all
targets: ## run cupid in dry-run mode (-n) to show targeting activity
	node -r dotenv/config src/bin/cupid.js -v info --matching none -n $(IDS) | bunyan -o short

.PHONY:
search: NEEDLE=TODO# search text
search: ## grep the source code
	grep -HrnF '$(NEEDLE)' src

.PHONY:
shell: node_modules ## start repl with goodies already loaded
	NODE_OPTIONS=--experimental-repl-await node -r dotenv/config -i -e "$$(cat src/bin/shell.js)"

.PHONY:
sql: ## play debug sql
	PAGER=cat /usr/local/opt/postgresql@12/bin/psql -X -f play.sql bap
