import Procedure from "./procedures/Procedure";

// A namespace is a collection of procedures under the same name
// A namespace can contain other namespaces

export type Procedures = {
  [key: string]: Procedure | Namespace<Procedures>;
};

export default class Namespace<P extends Procedures> {
  constructor(public readonly procedures: P) {}
}
