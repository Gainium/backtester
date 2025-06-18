/* eslint-disable no-undef */
/**
 * Configuration options for the file reader
 */
interface FileReaderConfig {
  /** Buffer size for reading chunks of data */
  bufferSize: number
  /** Text encoding to use when reading the file */
  encoding: BufferEncoding
}

/**
 * Default configuration for file reading operations
 */
const DEFAULT_CONFIG: FileReaderConfig = {
  bufferSize: 32768, // 32KB buffer
  encoding: 'utf-8',
}

/**
 * Utility class for efficient line-by-line file reading
 *
 * This class provides streaming file reading capabilities that work efficiently
 * with large files by reading them in chunks and yielding complete lines.
 * It handles partial lines across buffer boundaries and supports different
 * text encodings.
 *
 * @example
 * ```typescript
 * const reader = new FileReader();
 * for (const line of reader.readLines('/path/to/file.csv')) {
 *   console.log(line);
 * }
 * ```
 */
export class FileReader {
  private config: FileReaderConfig

  /**
   * Creates a new FileReader instance
   *
   * @param config - Optional configuration overrides
   */
  constructor(config: Partial<FileReaderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Checks if file operations are supported in the current environment
   *
   * @returns True if running in Node.js environment with file system access
   */
  public isFileSystemAvailable(): boolean {
    return Boolean(
      typeof process !== 'undefined' &&
        process.versions &&
        process.versions.node,
    )
  }

  /**
   * Reads a file line by line using a generator for memory efficiency
   *
   * This method reads the file in chunks and yields complete lines,
   * handling partial lines that span across buffer boundaries.
   *
   * @param filename - Path to the file to read
   * @param encoding - Text encoding override for this operation
   * @returns Generator that yields individual lines from the file
   *
   * @throws Error if file operations are not supported or file cannot be read
   */
  public *readLines(
    filename: string,
    encoding: BufferEncoding = this.config.encoding,
  ): Generator<string, void, unknown> {
    if (!this.isFileSystemAvailable()) {
      throw new Error(
        'File operations are not supported in browser environment',
      )
    }

    const fs = require('fs')
    const { StringDecoder } = require('string_decoder')

    let fd: number
    try {
      fd = fs.openSync(filename, 'r')
    } catch (error) {
      throw new Error(`Failed to open file: ${filename}. ${error}`)
    }

    const buf = Buffer.allocUnsafe(this.config.bufferSize)
    let pos = 0
    const decoder = new StringDecoder(encoding)
    let lineStart = ''

    try {
      while (true) {
        // Read buffer chunk
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, pos)
        pos += bytesRead

        // Decode string from buffer
        let str: string
        if (bytesRead < buf.length) {
          str = lineStart + decoder.end(buf.subarray(0, bytesRead))
        } else {
          str = lineStart + decoder.write(buf)
        }

        // Split into lines and yield complete ones
        const lines = str.split(/\r?\n/)
        for (let i = 0; i < lines.length - 1; i++) {
          yield lines[i]
        }

        // The last line is the start of the first line in the next chunk
        lineStart = lines[lines.length - 1]

        // Exit if end of file reached
        if (bytesRead < buf.length) {
          break
        }
      }

      // Yield the final line if it exists
      if (lineStart) {
        yield lineStart
      }
    } finally {
      fs.closeSync(fd)
    }
  }

  /**
   * Creates a stub generator for environments where file system is not available
   *
   * @param _filename - Filename (ignored, for compatibility)
   * @param _encoding - Encoding (ignored, for compatibility)
   * @returns Empty generator with warning
   */
  // eslint-disable-next-line require-yield
  public *readLinesStub(
    _filename: string,
    _encoding?: BufferEncoding,
  ): Generator<string, void, unknown> {
    console.warn(`File operations not supported. Cannot read: ${_filename}`)
    return
  }

  /**
   * Gets the appropriate line reader function based on environment
   *
   * @returns Line reading function (real or stub based on environment)
   */
  public getLineReader(): (
    filename: string,
    encoding?: BufferEncoding,
  ) => Generator<string, void, unknown> {
    return this.isFileSystemAvailable()
      ? this.readLines.bind(this)
      : this.readLinesStub.bind(this)
  }
}

/**
 * Default file reader instance for convenience
 */
export const defaultFileReader = new FileReader()

/**
 * Legacy function for backward compatibility
 * @deprecated Use FileReader class instead
 */
export function getFileLinesSync(
  file: string,
  encoding: BufferEncoding,
): Generator<string, void, unknown> {
  return defaultFileReader.getLineReader()(file, encoding)
}
