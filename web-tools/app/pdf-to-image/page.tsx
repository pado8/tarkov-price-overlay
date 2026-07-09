import ToolPage, { toolMetadata } from '@/components/ToolPage';
import PdfToImage from '@/components/tools/PdfToImage';

export const metadata = toolMetadata('pdf-to-image');

export default function Page() {
  return (
    <ToolPage slug="pdf-to-image">
      <PdfToImage />
    </ToolPage>
  );
}
