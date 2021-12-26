import { DeleteCommandInput, PutCommandInput, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';

import { TableUtil } from './TableUtil';

export interface PendingAction {
  action: 'Put' | 'Delete' | 'Update';
  params: PutCommandInput | DeleteCommandInput | UpdateCommandInput;
}

export class PendingPut implements PendingAction {
  readonly action = 'Put';
  constructor(readonly params: PutCommandInput) {}
}

export class PendingUpdate implements PendingAction {
  readonly action = 'Update';
  constructor(readonly params: UpdateCommandInput) {}
}

export class PendingDelete implements PendingAction {
  readonly action = 'Delete';
  constructor(readonly params: DeleteCommandInput) {}
}

type Util = Pick<TableUtil, 'client'>;

export class Transaction {
  private pendingActions: Array<PendingAction> = [];

  constructor(readonly util: Util) {}

  static begin(util: Util, ...actions: PendingAction[]): Transaction {
    if (actions.length > 25) {
      throw new Error('Cannot begin transaction, number of items must be equal to or less than 25');
    }
    const transaction = new Transaction(util);
    transaction.pendingActions.push(...actions);
    return transaction;
  }

  add(...actions: PendingAction[]): Transaction {
    this.pendingActions.push(...actions);
    if (this.pendingActions.length > 25) {
      throw new Error('Cannot set any item, number of items must be equal to or less than 25');
    }
    return this;
  }

  async commit(): Promise<void> {
    if (this.pendingActions.length < 1) {
      throw new Error('Cannot commit transaction, number of items must be greater than zero');
    }
    const items = this.pendingActions.map((pendingAction) => {
      return { [pendingAction.action]: pendingAction.params };
    });
    await this.util.client.transactWrite({ TransactItems: items });
  }
}
