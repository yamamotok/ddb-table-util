import { ulid } from 'ulid';

import { TableUtil } from '../src/TableUtil';

interface MyItem {
  pk: string;
  sk: string;
  dateType?: string;
}

describe('make sure if type hint works good with a custom item type', () => {
  let util: TableUtil<MyItem>;

  beforeAll(() => {
    util = new TableUtil<MyItem>({
      tableName: 'TEST',
      partitionKeyName: 'pk',
      dbConfig: {
        endpoint: ' http://localhost:8833',
        region: 'us-east-1',
      },
      serializer: (v) => ({ ...v, extra: 'well-processed' }),
    });
  });

  it('should put an item', async () => {
    // should get type hint for pk, sk, and dataType.
    const item = {
      pk: 'PK',
      sk: 'SK#' + ulid(),
      dateType: 'TestData',
      another: 3,
    };
    await expect(util.put(item)).resolves.toBeUndefined();
    const check = await util.get({ pk: item.pk, sk: item.sk }, { ConsistentRead: true });
    expect(check).toBeTruthy();
    expect(check?.extra).toBe('well-processed');
  });
});
