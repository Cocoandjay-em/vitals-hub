// minimal browser API stubs so pdfjs can load under plain node for testing
class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  constructor(_init?: unknown) {}
  multiply() { return new DOMMatrixStub() }
  inverse() { return new DOMMatrixStub() }
  translate() { return new DOMMatrixStub() }
  scale() { return new DOMMatrixStub() }
  rotate() { return new DOMMatrixStub() }
  transformPoint(p: { x: number; y: number }) { return p }
}
class Path2DStub {
  constructor(_p?: unknown) {}
}
const g = globalThis as Record<string, unknown>
if (typeof g.DOMMatrix === 'undefined') g.DOMMatrix = DOMMatrixStub
if (typeof g.Path2D === 'undefined') g.Path2D = Path2DStub
