import ToolPage, { toolMetadata } from '@/components/ToolPage';
import PdfMerge from '@/components/tools/PdfMerge';

export const metadata = toolMetadata('pdf-merge');

export default function Page() {
  return (
    <ToolPage slug="pdf-merge">
      <PdfMerge />
    </ToolPage>
  );
}
