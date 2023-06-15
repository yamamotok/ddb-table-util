DynamoDB Table Util
----------------------

Tiny DynamoDB utility for projects in TypeScript.

## Basic Operation
- get
- put
- update
- delete
- scan
- scanAll
- query
- queryWithPagination
- queryAll

## Conditional operation
- putIfNotExists (no exception is thrown even if the target already exists.)
- putIfExists (no exception is thrown even if the target does not exist.)
 
## Transaction
- transactional put
- transactional putIfNotExists
- transactional putIfExists

```typescript
const pending1 = util.transactionalPut(input1);
const pending2 = util.transactionalPut(input2);
await Transaction.begin(util, pending1, pending2).commit();
```

## Batch operation
TODO: will be implemented.

## Peer dependencies
- @aws-sdk/client-dynamodb
- @aws-sdk/lib-dynamodb 

--------

## Library development
Before running unit tests, need to set up DynamoDB local version. See [docker-compose.yml](./docker-compose.yml)
and [scripts/dynamodb.sh](./scripts/dynamodb.sh).

--------

&copy; Keisuke Yamamoto
