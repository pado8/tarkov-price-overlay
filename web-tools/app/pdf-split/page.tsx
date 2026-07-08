import ToolPage, { toolMetadata } from '@/components/ToolPage';
import PdfSplit from '@/components/tools/PdfSplit';

export const metadata = toolMetadata('pdf-split');

export default function Page() {
  return (
    <ToolPage slug="pdf-split">
      <PdfSplit />
    </ToolPage>
  );
}
