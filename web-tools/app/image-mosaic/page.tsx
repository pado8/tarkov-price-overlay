import ToolPage, { toolMetadata } from '@/components/ToolPage';
import ImageMosaic from '@/components/tools/ImageMosaic';

export const metadata = toolMetadata('image-mosaic');

export default function Page() {
  return (
    <ToolPage slug="image-mosaic">
      <ImageMosaic />
    </ToolPage>
  );
}
