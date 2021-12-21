import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommandInput,
  DynamoDBDocument,
  GetCommandInput,
  PutCommandInput,
  QueryCommandInput,
  QueryCommandOutput,
  ScanCommandInput,
  UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { ScanCommandOutput } from '@aws-sdk/lib-dynamodb/dist-types/commands/ScanCommand';
import type { marshallOptions } from '@aws-sdk/util-dynamodb';

import { PendingDelete, PendingPut } from './Transaction';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ItemType = Record<string, any>;
type PutOptions = Omit<PutCommandInput, 'TableName' | 'Item'>;
type GetOptions = Omit<GetCommandInput, 'TableName' | 'Key'>;
type UpdateOptions = Omit<UpdateCommandInput, 'TableName' | 'UpdateExpression' | 'Key'>;
type DeleteOptions = Omit<DeleteCommandInput, 'TableName'>;
type ScanOptions = Omit<ScanCommandInput, 'TableName'>;
type QueryOptions = Omit<QueryCommandInput, 'TableName'>;

export type ItemPreprocessor = <T = unknown>(item: T) => ItemType;

export interface TableUtilOptions {
  tableName: string;
  partitionKeyName: string;
  marshalOptions?: marshallOptions;
  itemPreprocessor?: <T = ItemType>(item: T) => ItemType;
}

/**
 * This is a DynamoDBDocumentClient wrapper which provides some additional utilities.
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_lib_dynamodb.html
 *
 * @param T item interface
 */
export class TableUtil<T = ItemType> {
  static readonly defaultMarshalOptions: marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  } as const;

  private readonly lowLevelClient: DynamoDBClient;
  private _client?: DynamoDBDocument;
  readonly tableName: string;
  readonly partitionKeyName: string;
  readonly marshalOptions: marshallOptions;
  readonly itemPreprocessor?: ItemPreprocessor;

  constructor(client: DynamoDBClient, options: TableUtilOptions) {
    this.lowLevelClient = client;
    this.tableName = options.tableName;
    this.partitionKeyName = options.partitionKeyName;
    this.marshalOptions = { ...TableUtil.defaultMarshalOptions, ...options.marshalOptions };
    this.itemPreprocessor = options.itemPreprocessor;
  }

  get client(): DynamoDBDocument {
    if (this._client) {
      return this._client;
    }
    return (this._client = DynamoDBDocument.from(this.lowLevelClient, {
      marshallOptions: this.marshalOptions,
    }));
  }

  preprocessItem(item: ItemType): ItemType {
    if (this.itemPreprocessor) {
      return this.itemPreprocessor(item);
    }
    return item;
  }

  /**
   * Put, simply.
   */
  async put(item: ItemType & T, options?: PutOptions): Promise<void> {
    await this.client.put({
      ...options,
      TableName: this.tableName,
      Item: this.preprocessItem(item),
    });
  }

  /**
   * Put if any record with same key does not exist.
   * This will do "insert" instead of "upsert".
   * @return true when succeeded, false when another already exists.
   */
  async putIfNotExists(
    item: ItemType & T,
    options?: Omit<PutOptions, 'ConditionExpression'>
  ): Promise<boolean> {
    try {
      await this.client.put({
        ...options,
        TableName: this.tableName,
        Item: this.preprocessItem(item),
        ConditionExpression: `attribute_not_exists(${this.partitionKeyName})`,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw err;
    }
    return true;
  }

  /**
   * Put if a record with same key already exists.
   * @return true when succeeded, false when any record with same key does not exist.
   */
  async putIfExists(
    item: ItemType & T,
    options?: Omit<PutOptions, 'ConditionExpression'>
  ): Promise<boolean> {
    try {
      await this.client.put({
        ...options,
        TableName: this.tableName,
        Item: this.preprocessItem(item),
        ConditionExpression: `attribute_exists(${this.partitionKeyName})`,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw err;
    }
    return true;
  }

  /**
   * Get, simply.
   */
  async get(key: Partial<T>, options?: GetOptions): Promise<(ItemType & T) | null> {
    const res = await this.client.get({
      ...options,
      Key: key,
      TableName: this.tableName,
    });
    if (!res.Item) {
      return null;
    }
    return res.Item as ItemType & T;
  }

  /**
   * Update, simply.
   * This won't do "UPSERT". In case update target is missing, `null` is returned.
   */
  async update(
    key: Partial<T>,
    attributes: ItemType & T,
    options?: UpdateOptions
  ): Promise<ItemType & T> {
    const condition = `attribute_exists(${this.partitionKeyName})`;
    const updateOptions = TableUtil.buildUpdateOptions(attributes);
    const params: UpdateCommandInput = {
      ...options,
      ReturnValues: 'ALL_NEW',
      UpdateExpression: updateOptions.expression,
      ExpressionAttributeNames: {
        ...options?.ExpressionAttributeNames,
        ...updateOptions.attributeNames,
      },
      ExpressionAttributeValues: {
        ...options?.ExpressionAttributeValues,
        ...updateOptions.attributeValues,
      },
      ConditionExpression: options?.ConditionExpression
        ? `${condition} and (${options.ConditionExpression})`
        : condition,
      TableName: this.tableName,
      Key: key,
    };

    const data = await this.client.update(params);
    if (data.Attributes) {
      return data.Attributes as ItemType & T;
    }
    throw Error('Update result is empty');
  }

  /**
   * Delete, simply.
   */
  async delete(key: Partial<T>, options?: DeleteOptions): Promise<void> {
    await this.client.delete({
      ...options,
      Key: key,
      TableName: this.tableName,
    });
  }

  /**
   * scan, simply.
   */
  async scan(options?: ScanOptions): Promise<Array<ItemType & T>> {
    const res = await this.client.scan({
      ...options,
      TableName: this.tableName,
    });
    if (!res.Items) {
      return [];
    }
    return res.Items as Array<ItemType & T>;
  }

  /**
   * Scan all.
   */
  async scanAll(options?: ScanOptions): Promise<Array<ItemType & T>> {
    const baseParams = { ...options, TableName: this.tableName };
    let lastEvaluatedKey: ScanCommandOutput['LastEvaluatedKey'] = undefined;
    const buffer: ItemType[] = [];
    do {
      const params: ScanCommandInput = {
        ...baseParams,
        ExclusiveStartKey: lastEvaluatedKey,
      };
      const data = await this.client.scan(params);
      if (data.Items) {
        buffer.push(...data.Items);
      }
      lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return buffer as Array<ItemType & T>;
  }

  /**
   * Query, simply.
   */
  async query(options?: QueryOptions): Promise<Array<ItemType & T>> {
    const res = await this.client.query({
      ...options,
      TableName: this.tableName,
    });
    if (!res.Items) {
      return [];
    }
    return res.Items as Array<ItemType & T>;
  }

  /**
   * Query with pagination.
   */
  async queryWithPagination(
    options: QueryOptions & { pageSize: number; pageIndex: number }
  ): Promise<Array<ItemType & T>> {
    const { pageSize, pageIndex, ...restOpts } = options;
    let lastEvaluatedKey: QueryCommandOutput['LastEvaluatedKey'] = undefined;

    for (let i = 0; i < pageIndex; i++) {
      const params: QueryCommandInput = {
        ...restOpts,
        TableName: this.tableName,
        Limit: pageSize,
        ProjectionExpression: this.partitionKeyName,
        ExclusiveStartKey: lastEvaluatedKey,
      };
      const data = await this.client.query(params);
      lastEvaluatedKey = data.LastEvaluatedKey;
      if (!lastEvaluatedKey) {
        break;
      }
    }

    if (pageIndex > 0 && !lastEvaluatedKey) {
      return []; // page index is out of bounds.
    }

    const params: QueryCommandInput = {
      ...restOpts,
      TableName: this.tableName,
      Limit: pageSize,
      ExclusiveStartKey: lastEvaluatedKey,
    };
    const data = await this.client.query(params);
    if (!data.Items) {
      return [];
    }
    return data.Items as Array<ItemType & T>;
  }

  /**
   * Query all items.
   */
  async queryAll(options?: QueryOptions): Promise<Array<ItemType & T>> {
    const baseParams = { ...options, TableName: this.tableName };
    let lastEvaluatedKey: QueryCommandOutput['LastEvaluatedKey'] = undefined;
    const buffer: ItemType[] = [];

    do {
      const params: QueryCommandInput = {
        ...baseParams,
        ExclusiveStartKey: lastEvaluatedKey,
      };
      const data = await this.client.query(params);
      if (data.Items) {
        buffer.push(...data.Items);
      }
      lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return buffer as Array<ItemType & T>;
  }

  /**
   * Transactional {@link put}. See {@link Transaction} and check how to use.
   */
  transactionalPut(item: ItemType, optionalParams?: PutOptions): PendingPut {
    const params: PutCommandInput = {
      ...optionalParams,
      TableName: this.tableName,
      Item: this.preprocessItem(item),
    };
    return new PendingPut(params);
  }

  /**
   * Transactional {@link putIfNotExists}. See {@link Transaction} and check how to use.
   */
  transactionalPutIfNotExists(
    item: ItemType,
    options?: Omit<PutOptions, 'ConditionExpression'>
  ): PendingPut {
    const condition = `attribute_not_exists(${this.partitionKeyName})`;
    const params: PutCommandInput = {
      ...options,
      ConditionExpression: condition,
      TableName: this.tableName,
      Item: this.preprocessItem(item),
    };
    return new PendingPut(params);
  }

  /**
   * Transactional {@link putIfExists}. See {@link Transaction} and check how to use.
   */
  transactionalPutIfExists(
    item: ItemType,
    options?: Omit<PutOptions, 'ConditionExpression'>
  ): PendingPut {
    const condition = `attribute_exists(${this.partitionKeyName})`;
    const params = {
      ...options,
      ConditionExpression: condition,
      TableName: this.tableName,
      Item: this.preprocessItem(item),
    };
    return new PendingPut(params);
  }

  /**
   * Transactional {@link delete}. See {@link Transaction} and check how to use.
   */
  transactionalDelete(key: ItemType, options?: DeleteOptions): PendingDelete {
    const params: DeleteCommandInput = {
      ...options,
      TableName: this.tableName,
      Key: key,
    };
    return new PendingDelete(params);
  }

  /**
   * Delete all items.
   * Note: Only for testing. Unsafe and too expensive.
   */
  async deleteAll(keyAttrName: string, rangeKeyAttrName?: string): Promise<void> {
    const rows = await this.client.scan({
      TableName: this.tableName,
      ProjectionExpression: rangeKeyAttrName ? `${keyAttrName},${rangeKeyAttrName}` : keyAttrName,
    });
    if (!rows.Items) {
      return;
    }
    for (const item of rows.Items) {
      const key = rangeKeyAttrName
        ? { [keyAttrName]: item[keyAttrName], [rangeKeyAttrName]: item[rangeKeyAttrName] }
        : { [keyAttrName]: item[keyAttrName] };
      await this.client.delete({ TableName: this.tableName, Key: key });
    }
  }

  /**
   * Build options for "update" operation.
   * In case `undefined` is given as value, the attribute will be deleted.
   */
  static buildUpdateOptions(attributes: Record<string, unknown>): {
    attributeNames: Record<string, string>;
    attributeValues: Record<string, unknown>;
    expression: string;
  } {
    const attributeNames: Record<string, string> = {};
    const attributeValues: Record<string, unknown> = {};
    const removals: string[] = [];
    const sets: string[] = [];

    Object.entries(attributes).forEach(([k, v]) => {
      const kk = `#${k}`;
      const vk = `:${k}`;
      if (v === undefined) {
        removals.push(kk);
      } else {
        sets.push(`${kk} = ${vk}`);
      }
      attributeNames[kk] = k;
      attributeValues[vk] = v;
    });

    const removeExpression = removals.length > 0 ? 'REMOVE ' + removals.join(', ') : '';
    const setExpression = sets.length > 0 ? 'SET ' + sets.join(', ') : '';

    return {
      attributeNames,
      attributeValues,
      expression: `${setExpression} ${removeExpression}`.trim(),
    };
  }
}
