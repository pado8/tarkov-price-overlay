import ToolPage, { toolMetadata } from '@/components/ToolPage';
import ImageConvert from '@/components/tools/ImageConvert';

export const metadata = toolMetadata('image-convert');

export default function Page() {
  return (
    <ToolPage slug="image-convert">
      <ImageConvert />
    </ToolPage>
  );
}
