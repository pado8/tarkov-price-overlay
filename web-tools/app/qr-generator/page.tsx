import ToolPage, { toolMetadata } from '@/components/ToolPage';
import QrGenerator from '@/components/tools/QrGenerator';

export const metadata = toolMetadata('qr-generator');

export default function Page() {
  return (
    <ToolPage slug="qr-generator">
      <QrGenerator />
    </ToolPage>
  );
}
