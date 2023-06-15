import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ulid } from 'ulid';

import { TableUtil } from '../src/TableUtil';
import { Transaction } from '../src/Transaction';

import { sleep } from './sleep';

describe('test main functionality', () => {
  let util: TableUtil;
  let input: { pk: string; sk: string; dataType: string };

  beforeAll(() => {
    const lowLevelClient = new DynamoDBClient({
      endpoint: ' http://localhost:8833',
      region: 'us-east-1',
    });
    util = new TableUtil({ tableName: 'TEST', partitionKeyName: 'pk', dbClient: lowLevelClient });
  });

  beforeEach(() => {
    input = { pk: 'PK', sk: `SK#` + ulid(), dataType: 'Person' };
  });

  it('should put an item', async () => {
    await expect(util.put(input)).resolves.toBeUndefined();
    const check = await util.get({ pk: input.pk, sk: input.sk }, { ConsistentRead: true });
    expect(check).toEqual(input);
  });

  it('should put an item if no key duplication, or fail', async () => {
    expect(await util.putIfNotExists(input)).toBe(true);
    expect(await util.putIfNotExists(input)).toBe(false);
  });

  it('should fail to put an item if no existing one, or succeed', async () => {
    expect(await util.putIfExists(input)).toBe(false);
    await util.put(input);
    expect(await util.putIfExists(input)).toBe(true);
  });

  describe('update operation', () => {
    beforeEach(async () => {
      await util.put(input);
      await sleep();
    });

    it('should update an attribute on existing item', async () => {
      const updated = await util.update({ pk: input.pk, sk: input.sk }, { extra: '!' });
      expect(updated.pk).toBe(input.pk);
      expect(updated.sk).toBe(input.sk);
      expect(updated.extra).toBe('!');
    });

    it('should update an attribute on existing item conditionally', async () => {
      await util.update({ pk: input.pk, sk: input.sk }, { extra: '!' });
      const updated1 = await util.update(
        { pk: input.pk, sk: input.sk },
        { extra: '!!' },
        {
          ConditionExpression: 'extra = :current_extra',
          ExpressionAttributeValues: { ':current_extra': '!' },
        }
      );
      expect(updated1.pk).toBe(input.pk);
      expect(updated1.sk).toBe(input.sk);
      expect(updated1.extra).toBe('!!');
    });

    it('should not update an attribute on existing item if the condition is bad', async () => {
      await util.update({ pk: input.pk, sk: input.sk }, { extra: '!' });
      const updatePromise = util.update(
        { pk: input.pk, sk: input.sk },
        { extra: '!!' },
        {
          ConditionExpression: 'extra = :current_extra',
          ExpressionAttributeValues: { ':current_extra': '?' },
        }
      );
      await expect(updatePromise).rejects.toThrow();
    });

    it('should fail to update when the target is missing', async () => {
      await expect(util.update({ pk: 'Hello' }, { sk: 'World', extra: '!' })).rejects.toThrow();
    });
  });

  it('should query some items', async () => {
    const promises = [
      { pk: '123', sk: 'Hello' },
      { pk: '456', sk: 'World' },
    ].map((input) => {
      return util.put(input);
    });

    await Promise.all(promises);

    const found = await util.query({
      ExpressionAttributeValues: { ':pk': '123' },
      KeyConditionExpression: 'pk = :pk',
      ConsistentRead: true,
    });

    expect(found.length).toBe(1);
    expect(found[0]).toEqual({ pk: '123', sk: 'Hello' });
  });

  describe('Use transaction', () => {
    it('should put some items in transaction', async () => {
      const input1 = { pk: 'PK', sk: `SK#` + ulid(), dataType: 'Person1' };
      const input2 = { pk: 'PK', sk: `SK#` + ulid(), dataType: 'Person2' };
      const pending1 = util.transactionalPut(input1);
      const pending2 = util.transactionalPut(input2);
      await Transaction.begin(util, pending1, pending2).commit();
      const check1 = await util.get({ pk: input1.pk, sk: input1.sk }, { ConsistentRead: true });
      expect(check1).toBeTruthy();
      const check2 = await util.get({ pk: input2.pk, sk: input2.sk }, { ConsistentRead: true });
      expect(check2).toBeTruthy();
    });

    it('should put some items conditionally (put if not exists) in transaction', async () => {
      const input1 = { pk: 'PK', sk: `SK#` + ulid(), dataType: 'Person1' };
      const input2 = { pk: 'PK', sk: `SK#` + ulid(), dataType: 'Person2' };
      const pending1 = util.transactionalPutIfNotExists(input1);
      const pending2 = util.transactionalPutIfNotExists(input2);
      await Transaction.begin(util, pending1, pending2).commit();
      const check1 = await util.get({ pk: input1.pk, sk: input1.sk }, { ConsistentRead: true });
      expect(check1).toBeTruthy();
      const check2 = await util.get({ pk: input2.pk, sk: input2.sk }, { ConsistentRead: true });
      expect(check2).toBeTruthy();
    });

    it('should fail to put some items because of condition (put if not exists) check failure', async () => {
      await util.put(input);
      await sleep();
      const pending = util.transactionalPutIfNotExists(input);
      await expect(Transaction.begin(util, pending).commit()).rejects.toThrow();
    });

    it('should put some items conditionally (put if exists) in transaction', async () => {
      await util.put(input);
      await sleep();
      const pending = util.transactionalPutIfExists({ ...input, extra: '*' });
      await expect(Transaction.begin(util, pending).commit()).resolves.toBeUndefined();
    });

    it('should fail to put some items because of condition (put if exists) check failure', async () => {
      const pending = util.transactionalPutIfExists(input);
      await expect(Transaction.begin(util, pending).commit()).rejects.toThrow();
    });

    it('should delete some items in transaction', async () => {
      const input1 = { pk: 'PK', sk: `SK#` + ulid(), dataType: 'Person1' };
      const input2 = { pk: 'PK', sk: `SK#` + ulid(), dataType: 'Person2' };
      await Promise.all([util.put(input1), util.put(input2)]);
      await sleep();
      const pendingDel1 = util.transactionalDelete({ pk: input1.pk, sk: input1.sk });
      const pendingDel2 = util.transactionalDelete({ pk: input2.pk, sk: input2.sk });
      const pendingPut = util.transactionalPut(input);
      const tran = Transaction.begin(util, pendingDel1, pendingDel2, pendingPut);
      await tran.commit();

      await expect(
        util.get({ pk: input1.pk, sk: input1.sk }, { ConsistentRead: true })
      ).resolves.toBeNull();
      await expect(
        util.get({ pk: input2.pk, sk: input2.sk }, { ConsistentRead: true })
      ).resolves.toBeNull();
      await expect(
        util.get({ pk: input.pk, sk: input.sk }, { ConsistentRead: true })
      ).resolves.toBeTruthy();
    });
  });
});
