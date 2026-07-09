import ToolPage, { toolMetadata } from '@/components/ToolPage';
import ImageOcr from '@/components/tools/ImageOcr';

export const metadata = toolMetadata('image-ocr');

export default function Page() {
  return (
    <ToolPage slug="image-ocr">
      <ImageOcr />
    </ToolPage>
  );
}
