import type { Node } from 'estree';
import BaseJSNode from './nodes/BaseJSNode.js';
import * as Nodes from './nodes/index.js';
import { JSNodeConstructor } from './utils/index.js';

export type Listener = (node: Node, visitor: Visitor) => any;

export default class Visitor {
  public scope: Map<string, any> = new Map();
  public listeners: { [key: string]: Listener } = {};
  public ast: Node[] = [];

  public setAST(ast: Node[]) {
    this.ast = ast;
  }

  public run() {
    let result;

    for (const node of this.ast) {
      result = this.visitNode(node);
    }

    return result;
  }

  /**
   * Visits a given node and executes it.
   */
  public visitNode<T extends BaseJSNode>(node?: Node | null) {
    if (!node)
      return null;

    const target_node = this.#getNode<T>(node.type);

    if (target_node) {
      const instance = new target_node(node, this);
      return instance.run();
    }
  }

  /**
   * Gets the name of a node.
   * @param node - The target node.
   */
  public getName(node: Node) {
    if (node.type === 'Identifier')
      return node.name;
    else if (node.type === 'Literal')
      return node.value as string;
  }

  /**
   * Listens for node calls. Can be used to override default behavior or add new functionality.
   * @param node_name - The node to listen for.
   * @param listener - The callback function.
   */
  public on(node_name: string, listener: Listener): void {
    this.listeners[node_name] = listener;
  }

  #getNode<T extends BaseJSNode>(type: string) {
    const node = Nodes[type as keyof typeof Nodes] as JSNodeConstructor<T>;

    return node;
  }
}