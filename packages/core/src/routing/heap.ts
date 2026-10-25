/** Binary min-heap; duplicate entries are discarded by A* when popped. */
export class MinHeap<T> {
  private items: { value: T; priority: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(value: T, priority: number): void {
    const item = { value, priority };
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.priority <= priority) break;
      this.items[i] = this.items[parent]!;
      i = parent;
    }
    this.items[i] = item;
  }
  pop(): T | undefined {
    const first = this.items[0],
      last = this.items.pop();
    if (!first || !this.items.length || !last) return first?.value;
    let i = 0;
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1;
      if (
        child + 1 < this.items.length &&
        this.items[child + 1]!.priority < this.items[child]!.priority
      )
        child++;
      if (last.priority <= this.items[child]!.priority) break;
      this.items[i] = this.items[child]!;
      i = child;
    }
    this.items[i] = last;
    return first.value;
  }
}
