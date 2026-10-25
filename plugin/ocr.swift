// OCR a scanned PDF with macOS's own text recognition (Vision), for pdf.js.
//
//   ocr <file.pdf>
//
// Prints one JSON object per page on stdout as soon as it is read, in any order:
//   {"page":0,"pages":300,"width":595,"height":842,"lines":[{"x0":..,"x1":..,"y0":..,"y1":..,"text":".."}]}
// Coordinates are PDF points from the top left, like pdftotext's, so the same layout rules apply.

import Foundation
import PDFKit
import Vision

let args = CommandLine.arguments
guard args.count == 2, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("usage: ocr <file.pdf>\n".data(using: .utf8)!)
  exit(2)
}

let count = doc.pageCount
let out = NSLock()
// Long side of the rendered page, in pixels: enough for small print, not so big that Vision slows down.
let renderSide: CGFloat = 2400

func read(_ index: Int) {
  guard let page = doc.page(at: index) else { return }
  let box = page.bounds(for: .mediaBox)
  let scale = renderSide / max(box.width, box.height)
  let image = page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
  var lines: [[String: Any]] = []
  if let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = true
    try? VNImageRequestHandler(cgImage: cg).perform([request])
    for observation in request.results ?? [] {
      guard let text = observation.topCandidates(1).first?.string, !text.isEmpty else { continue }
      let r = observation.boundingBox
      lines.append([
        "x0": r.minX * box.width, "x1": r.maxX * box.width,
        "y0": (1 - r.maxY) * box.height, "y1": (1 - r.minY) * box.height,
        "text": text,
      ])
    }
  }
  let record: [String: Any] = ["page": index, "pages": count, "width": box.width, "height": box.height, "lines": lines]
  let data = try! JSONSerialization.data(withJSONObject: record)
  out.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  out.unlock()
}

// A few pages at once keeps the Neural Engine and GPU busy without running out of memory.
let queue = OperationQueue()
queue.maxConcurrentOperationCount = 4
for i in 0..<count { queue.addOperation { autoreleasepool { read(i) } } }
queue.waitUntilAllOperationsAreFinished()
