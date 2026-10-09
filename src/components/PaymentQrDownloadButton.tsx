import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getPaymentQrImage } from "@/lib/payment-qr-download.functions";

export function PaymentQrDownloadButton({ paymentId }: { paymentId: string }) {
  const [downloading, setDownloading] = useState(false);
  const getImage = useServerFn(getPaymentQrImage);

  const downloadQr = async () => {
    if (downloading) return;

    setDownloading(true);

    try {
      const image = await getImage({
        data: { paymentId },
      });

      const bytes = Uint8Array.from(atob(image.base64), (char) => char.charCodeAt(0));

      const blob = new Blob([bytes], {
        type: image.mimeType,
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = image.filename;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 10000);

      toast.success("Đã tải mã QR thanh toán.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể tải mã QR thanh toán.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={downloading}
      onClick={() => void downloadQr()}
    >
      {downloading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}

      {downloading ? "Đang tải QR..." : "Tải mã QR thanh toán"}
    </Button>
  );
}
