#!/usr/bin/env bash

function describe() {
  table_name="$1"
  aws dynamodb describe-table --endpoint-url http://localhost:8833 --table-name "$table_name" &>/dev/null
}

function create() {
  table_name="$1"
  json_file="$2"
  json=$(sed "s/=TABLE=/${table_name}/g" "./${json_file}")
  aws ${PROFILE:+--profile "$PROFILE"} dynamodb create-table --endpoint-url http://localhost:8833 --cli-input-json "$json"
}

function create_if_not_exists() {
  table="$1"
  json="$2"
  describe "$table"
  if [ $? -ne 0 ]; then
    create "$table" "$json"
  else
    echo "Table $table exists already"
  fi
}

#
# Create tables
#
create_if_not_exists "TEST" "table.json"
