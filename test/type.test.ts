import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ulid } from 'ulid';

import { TableUtil } from '../src/TableUtil';

interface MyItem {
  pk: string;
  sk: string;
  dateType?: string;
}

describe('test type hint for items', () => {
  let util: TableUtil<MyItem>;

  beforeAll(() => {
    const lowLevelClient = new DynamoDBClient({
      endpoint: ' http://localhost:8833',
      region: 'us-east-1',
    });
    util = new TableUtil<MyItem>(lowLevelClient, { tableName: 'TEST', partitionKeyName: 'pk' });
  });

  it('should put an item', async () => {
    // should get type hint for pk, sk, and dataType.
    await expect(
      util.put({
        pk: 'PK',
        sk: 'SK#' + ulid(),
        dateType: 'TestData',
        another: 3,
      })
    ).resolves.toBeUndefined();
  });
});
