declare module 'heic2any' {
  export default function heic2any(options: {
    blob: Blob;
    toType?: string;
    quality?: number;
    multiple?: boolean;
  }): Promise<Blob | Blob[]>;
}
