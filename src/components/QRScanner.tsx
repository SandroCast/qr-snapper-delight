
import React, { useEffect, useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Camera, Download, Video, Maximize, Minimize, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import JSZip from 'jszip';

async function preventScreenLock() {
  if ("wakeLock" in navigator) {
    try {
      let wakeLock = await navigator.wakeLock.request("screen");
      console.log("Wake Lock ativado!");

      // Se perder o Wake Lock ao minimizar, reativa ao voltar
      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible") {
          try {
            wakeLock = await navigator.wakeLock.request("screen");
            console.log("Wake Lock reativado!");
          } catch (err) {
            console.error("Erro ao reativar Wake Lock:", err);
          }
        }
      });
    } catch (err) {
      console.error("Wake Lock falhou:", err);
    }
  } else {
    console.warn("Wake Lock API não suportada no navegador.");
  }
}

interface CustomImageCapture {
  track: MediaStreamTrack;
  setTorch: (enabled: boolean) => Promise<void>;
}

const QRScanner = () => {
  const [targetQRCode, setTargetQRCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [useFlash, setUseFlash] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [cooldownProgress, setCooldownProgress] = useState(100);
  const [isCooldown, setIsCooldown] = useState(false);
  const [generatingTimelapse, setGeneratingTimelapse] = useState(false);
  const [timelapseSpeed, setTimelapseSpeed] = useState(1);
  const [showScanControls, setShowScanControls] = useState(false);
  
  // Região do scanner
  const [scanRegion, setScanRegion] = useState({
    x: 25, // porcentagem da largura
    y: 25, // porcentagem da altura
    width: 50, // porcentagem da largura
    height: 50, // porcentagem da altura
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState('');
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [scannerContainerSize, setScannerContainerSize] = useState({ width: 0, height: 0 });

  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processingRef = useRef<boolean>(false);
  const imageCaptureRef = useRef<CustomImageCapture | null>(null);
  const cooldownIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCameras();
    preventScreenLock();
    
    // Medir o tamanho do container do scanner
    const updateContainerSize = () => {
      if (scannerContainerRef.current) {
        setScannerContainerSize({
          width: scannerContainerRef.current.clientWidth,
          height: scannerContainerRef.current.clientHeight
        });
      }
    };
    
    updateContainerSize();
    window.addEventListener('resize', updateContainerSize);
    
    return () => {
      if (html5QrcodeRef.current) {
        html5QrcodeRef.current.stop().catch(error => console.error("Erro ao parar scanner:", error));
      }
      if (cooldownIntervalRef.current) {
        window.clearInterval(cooldownIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      window.removeEventListener('resize', updateContainerSize);
    };
  }, []);

  useEffect(() => {
    if (isScanning && useFlash) {
      turnOnFlash();
    } else if (!useFlash) {
      turnOffFlash();
    }
  }, [useFlash, isScanning]);

  // Quando o scanner é iniciado, mostrar os controles
  useEffect(() => {
    if (isScanning) {
      setShowScanControls(true);
    } else {
      setShowScanControls(false);
    }
  }, [isScanning]);

  // Quando a região de escaneamento muda, atualiza o scanner
  useEffect(() => {
    if (isScanning && html5QrcodeRef.current) {
      // Se estiver escaneando e a região mudar, para e reinicia o scanner
      const config = calculateScanRegion();
      // Precisamos parar e reiniciar para aplicar o novo tamanho/posição
      stopScanning();
      startScanning();
    }
  }, [scanRegion]);

  const turnOnFlash = async () => {
    try {
      const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (!videoElement?.srcObject) {
        console.log('No video source found');
        return;
      }

      const stream = videoElement.srcObject as MediaStream;
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      
      if (!track) {
        console.log('No video track found');
        return;
      }

      console.log('Attempting to turn on flash');
      
      try {
        // Try the standard way first
        await track.applyConstraints({
          advanced: [{ torch: true }] as any
        });
      } catch (e) {
        console.log('Standard torch failed, trying alternative method');
        // Try alternative method
        await track.applyConstraints({
          advanced: [{ fillLightMode: 'flash' }] as any
        });
      }
      
      console.log('Flash settings applied');
    } catch (error) {
      console.error('Error turning on flash:', error);
      toast.error('Não foi possível ativar a lanterna');
    }
  };

  const turnOffFlash = async () => {
    try {
      if (streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        if (track) {
          await track.applyConstraints({
            advanced: [{ torch: false }] as any
          });
        }
      }
    } catch (error) {
      console.error('Error turning off flash:', error);
    }
  };

  const loadCameras = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setCameras(videoDevices);
      if (videoDevices.length > 0) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
    } catch (error) {
      console.error('Erro ao carregar câmeras:', error);
      toast.error('Erro ao carregar câmeras disponíveis');
    }
  };

  const stopScanning = () => {
    if (html5QrcodeRef.current) {
      html5QrcodeRef.current.stop().catch(error => console.error("Erro ao parar scanner:", error));
      html5QrcodeRef.current = null;
    }
    setIsScanning(false);
  };

  const startCooldown = () => {
    setIsCooldown(true);
    setCooldownProgress(0);
    let progress = 0;
    
    stopScanning();
    
    if (cooldownIntervalRef.current) {
      window.clearInterval(cooldownIntervalRef.current);
    }
    
    cooldownIntervalRef.current = window.setInterval(() => {
      progress += 1;
      setCooldownProgress(progress);
      
      if (progress >= 100) {
        setIsCooldown(false);
        if (cooldownIntervalRef.current) {
          window.clearInterval(cooldownIntervalRef.current);
        }
        startScanning();
      }
    }, 100); // Updates every 100ms for smooth progress
  };

  // Calcular a região de escaneamento em pixels (valores absolutos)
  const calculateScanRegion = () => {
    const regionPixels = {
      x: Math.floor(scannerContainerSize.width * scanRegion.x / 100),
      y: Math.floor(scannerContainerSize.height * scanRegion.y / 100),
      width: Math.floor(scannerContainerSize.width * scanRegion.width / 100),
      height: Math.floor(scannerContainerSize.height * scanRegion.height / 100)
    };
    
    // Garantir que a região tem pelo menos 100x100 pixels para melhor detecção
    return regionPixels.width < 100 || regionPixels.height < 100 
      ? { width: Math.max(100, regionPixels.width), height: Math.max(100, regionPixels.height) }
      : { width: regionPixels.width, height: regionPixels.height };
  };

  const captureFrame = async () => {
    try {
      if (isCooldown) {
        toast.error('Aguarde o tempo de espera para capturar novamente');
        return;
      }

      const qrElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (!qrElement) {
        throw new Error('Video element not found');
      }

      if (useFlash) {
        await turnOnFlash();
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 segundos para estabilizar
      }

      const canvas = document.createElement('canvas');
      canvas.width = qrElement.videoWidth;
      canvas.height = qrElement.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      ctx.drawImage(qrElement, 0, 0, canvas.width, canvas.height);

      const base64Image = canvas.toDataURL('image/jpeg', 0.9);
      const base64Data = base64Image.split(',')[1];

      const fileName = `qr-snap-${Date.now()}.jpeg`;
      await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });

      setPhotos(prev => [...prev, fileName]);
      setPhotoCount(prev => prev + 1);
      toast.success('Foto capturada e salva!');

      if (useFlash) {
        await turnOffFlash();
      }
      
      startCooldown();
      
    } catch (error) {
      console.error('Erro ao capturar foto:', error);
      toast.error('Erro ao capturar foto');
      if (useFlash) await turnOffFlash();
    }
  };

  const startScanning = async () => {
    if (!targetQRCode.trim()) {
      toast.error('Por favor, insira um texto para buscar no QR Code');
      return;
    }

    try {
      if (isCooldown) {
        toast.error('Aguarde o fim do período de espera');
        return;
      }

      if (html5QrcodeRef.current) {
        html5QrcodeRef.current.stop().catch(error => console.error("Erro ao parar scanner:", error));
      }

      const html5Qrcode = new Html5Qrcode("qr-reader");
      html5QrcodeRef.current = html5Qrcode;

      // Remover elementos HTML QR Code internos que possam causar problemas
      const qrBoxElement = document.querySelector('#qr-reader__scan_region');
      if (qrBoxElement) {
        qrBoxElement.remove();
      }

      // Configurações do scanner
      const qrConfig = {
        fps: 10,
        qrbox: calculateScanRegion(),
        aspectRatio: 1.0,
        disableFlip: false,
        // Desabilitar bordas extras do HTML5-QRCode
        showTorchButtonIfSupported: false,
        showZoomSliderIfSupported: false
      };

      await html5Qrcode.start(
        { deviceId: { exact: selectedCamera } },
        qrConfig,
        (decodedText) => {
          if (processingRef.current || isCooldown) return;

          if (decodedText === targetQRCode) {
            processingRef.current = true;
            captureFrame().finally(() => {
              processingRef.current = false;
            });
          }
        },
        (errorMessage) => {
          // Silenciar erros de leitura - são esperados quando não há QR code
          if (!errorMessage.includes("No QR code found")) {
            console.log(errorMessage);
          }
        }
      );

      // Remover elementos da UI da biblioteca que possam estar causando duplicação da área
      setTimeout(() => {
        const qrBoxElements = document.querySelectorAll('[style*="border: 6px solid rgb(255, 255, 255)"]');
        qrBoxElements.forEach(element => {
          element.remove();
        });
      }, 500);

      setIsScanning(true);
    } catch (error) {
      console.error('Erro ao iniciar scanner:', error);
      toast.error('Erro ao iniciar scanner');
    }
  };

  const downloadPhotos = async () => {
    try {
      if (photos.length === 0) {
        toast.error('Nenhuma foto para baixar');
        return;
      }

      const zip = new JSZip();
      
      for (const photo of photos) {
        const file = await Filesystem.readFile({
          path: photo,
          directory: Directory.Documents,
          encoding: Encoding.UTF8
        });
        zip.file(photo, file.data, { base64: true });
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qr-snaps.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Fotos baixadas com sucesso!');
    } catch (error) {
      console.error('Erro ao baixar fotos:', error);
      toast.error('Erro ao baixar fotos');
    }
  };

  const createTimelapse = async () => {
    if (photos.length === 0) {
      toast.error('Nenhuma foto disponível para criar o timelapse');
      return;
    }

    try {
      setGeneratingTimelapse(true);
      toast.info('Iniciando geração do timelapse...');

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      const firstImageData = await Filesystem.readFile({
        path: photos[0],
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:image/jpeg;base64,${firstImageData.data}`;
      });

      canvas.width = img.width;
      canvas.height = img.height;

      let mimeType = '';
      let fileExtension = '';
      
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264')) {
        mimeType = 'video/mp4;codecs=h264';
        fileExtension = 'mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
        mimeType = 'video/webm;codecs=h264';
        fileExtension = 'webm';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
        fileExtension = 'webm';
      } else {
        mimeType = 'video/webm';
        fileExtension = 'webm';
      }

      const stream = canvas.captureStream(30); // 30fps
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 8000000 // 8Mbps para melhor qualidade
      });

      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timelapse.${fileExtension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setGeneratingTimelapse(false);
        toast.success('Timelapse gerado com sucesso!');
      };

      mediaRecorder.start();

      let frameCount = 0;
      const totalFrames = photos.length;

      for (const photo of photos) {
        const imageData = await Filesystem.readFile({
          path: photo,
          directory: Directory.Documents,
          encoding: Encoding.UTF8
        });

        await new Promise<void>((resolve) => {
          const frameImg = new Image();
          frameImg.onload = () => {
            ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
            
            frameCount++;
            const progress = Math.round((frameCount / totalFrames) * 100);
            toast.info(`Processando frames: ${progress}%`, {
              id: 'timelapse-progress'
            });
            
            resolve();
          };
          frameImg.src = `data:image/jpeg;base64,${imageData.data}`;
        });

        await new Promise(resolve => setTimeout(resolve, 100 / timelapseSpeed));
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      
      mediaRecorder.stop();

    } catch (error) {
      console.error('Erro ao gerar timelapse:', error);
      toast.error('Erro ao gerar timelapse');
      setGeneratingTimelapse(false);
    }
  };

  // Funções para manipulação da área de escaneamento
  const handleResizeStart = (direction: string, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    
    let clientX = 0;
    let clientY = 0;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    setDragStartPos({ x: clientX, y: clientY });
  };

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    
    let clientX = 0;
    let clientY = 0;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    setDragStartPos({ x: clientX, y: clientY });
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    
    if (!isDragging && !isResizing) return;
    
    const scannerRect = scannerContainerRef.current?.getBoundingClientRect();
    if (!scannerRect) return;

    let clientX = 0;
    let clientY = 0;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const deltaX = clientX - dragStartPos.x;
    const deltaY = clientY - dragStartPos.y;
    
    // Porcentagem de movimento em relação ao tamanho do container
    const deltaXPercent = (deltaX / scannerRect.width) * 100;
    const deltaYPercent = (deltaY / scannerRect.height) * 100;
    
    if (isDragging) {
      // Atualizar posição com limites
      setScanRegion((prev) => {
        const newX = Math.max(0, Math.min(100 - prev.width, prev.x + deltaXPercent));
        const newY = Math.max(0, Math.min(100 - prev.height, prev.y + deltaYPercent));
        return { ...prev, x: newX, y: newY };
      });
      
      // Atualizar ponto de início para o próximo movimento
      setDragStartPos({ x: clientX, y: clientY });
    } else if (isResizing) {
      setScanRegion((prev) => {
        let newRegion = { ...prev };
        
        if (resizeDirection.includes('n')) {
          const newHeight = Math.max(10, prev.height - deltaYPercent);
          const heightDiff = prev.height - newHeight;
          newRegion.y = Math.max(0, Math.min(100 - newHeight, prev.y + heightDiff));
          newRegion.height = newHeight;
        }
        
        if (resizeDirection.includes('s')) {
          newRegion.height = Math.max(10, Math.min(100 - prev.y, prev.height + deltaYPercent));
        }
        
        if (resizeDirection.includes('w')) {
          const newWidth = Math.max(10, prev.width - deltaXPercent);
          const widthDiff = prev.width - newWidth;
          newRegion.x = Math.max(0, Math.min(100 - newWidth, prev.x + widthDiff));
          newRegion.width = newWidth;
        }
        
        if (resizeDirection.includes('e')) {
          newRegion.width = Math.max(10, Math.min(100 - prev.x, prev.width + deltaXPercent));
        }
        
        return newRegion;
      });
      
      // Atualizar ponto de início para o próximo movimento
      setDragStartPos({ x: clientX, y: clientY });
    }
  };

  const handleEnd = () => {
    setIsDragging(false);
    setIsResizing(false);
  };

  // Funções para os botões de controle da área de escaneamento
  const moveLeft = () => {
    setScanRegion(prev => ({
      ...prev,
      x: Math.max(0, prev.x - 5)
    }));
  };

  const moveRight = () => {
    setScanRegion(prev => ({
      ...prev,
      x: Math.min(100 - prev.width, prev.x + 5)
    }));
  };

  const moveUp = () => {
    setScanRegion(prev => ({
      ...prev,
      y: Math.max(0, prev.y - 5)
    }));
  };

  const moveDown = () => {
    setScanRegion(prev => ({
      ...prev,
      y: Math.min(100 - prev.height, prev.y + 5)
    }));
  };

  const increaseWidth = () => {
    setScanRegion(prev => {
      const newWidth = Math.min(100 - prev.x, prev.width + 5);
      return {
        ...prev,
        width: newWidth
      };
    });
  };

  const decreaseWidth = () => {
    setScanRegion(prev => ({
      ...prev,
      width: Math.max(10, prev.width - 5)
    }));
  };

  const increaseHeight = () => {
    setScanRegion(prev => {
      const newHeight = Math.min(100 - prev.y, prev.height + 5);
      return {
        ...prev,
        height: newHeight
      };
    });
  };

  const decreaseHeight = () => {
    setScanRegion(prev => ({
      ...prev,
      height: Math.max(10, prev.height - 5)
    }));
  };

  // Reset da área de escaneamento para a posição central
  const resetScanRegion = () => {
    setScanRegion({
      x: 25,
      y: 25,
      width: 50,
      height: 50
    });
  };

  // Expandir área de escaneamento
  const expandScanRegion = () => {
    setScanRegion(prev => ({
      x: Math.max(0, prev.x - 5),
      y: Math.max(0, prev.y - 5),
      width: Math.min(100, prev.width + 10),
      height: Math.min(100, prev.height + 10)
    }));
  };

  // Reduzir área de escaneamento
  const shrinkScanRegion = () => {
    setScanRegion(prev => ({
      x: prev.x + 5,
      y: prev.y + 5,
      width: Math.max(20, prev.width - 10),
      height: Math.max(20, prev.height - 10)
    }));
  };

  // Remover elementos extras da biblioteca HTML5-QRCode
  const removeExtraScanRegions = () => {
    // Remove qualquer região de escaneamento renderizada pela biblioteca
    const qrBoxElements = document.querySelectorAll('[style*="border: 6px solid rgb(255, 255, 255)"]');
    qrBoxElements.forEach(element => {
      element.remove();
    });
  };

  // Renderizar a área de escaneamento
  const renderScanRegion = () => {
    if (!isScanning) return null;
    
    // Remover elementos extras da biblioteca HTML5-QRCode
    setTimeout(removeExtraScanRegions, 100);
    
    return (
      <div 
        className="absolute bg-transparent border-2 border-blue-500 cursor-move z-10"
        style={{
          left: `${scanRegion.x}%`,
          top: `${scanRegion.y}%`,
          width: `${scanRegion.width}%`,
          height: `${scanRegion.height}%`,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
        }}
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
      >
        {/* Controles de redimensionamento */}
        <div 
          className="absolute w-4 h-4 bg-blue-500 rounded-full -top-2 -left-2 cursor-nw-resize" 
          onMouseDown={(e) => handleResizeStart('nw', e)}
          onTouchStart={(e) => handleResizeStart('nw', e)}
        />
        <div 
          className="absolute w-4 h-4 bg-blue-500 rounded-full -top-2 -right-2 cursor-ne-resize" 
          onMouseDown={(e) => handleResizeStart('ne', e)}
          onTouchStart={(e) => handleResizeStart('ne', e)}
        />
        <div 
          className="absolute w-4 h-4 bg-blue-500 rounded-full -bottom-2 -left-2 cursor-sw-resize" 
          onMouseDown={(e) => handleResizeStart('sw', e)}
          onTouchStart={(e) => handleResizeStart('sw', e)}
        />
        <div 
          className="absolute w-4 h-4 bg-blue-500 rounded-full -bottom-2 -right-2 cursor-se-resize" 
          onMouseDown={(e) => handleResizeStart('se', e)}
          onTouchStart={(e) => handleResizeStart('se', e)}
        />
      </div>
    );
  };

  // Adicionar estilo para ocultar elementos indesejados da biblioteca HTML5-QRCode
  useEffect(() => {
    // Adicionar estilo CSS para ocultar o elemento com borda branca
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      [style*="border: 6px solid rgb(255, 255, 255)"] {
        display: none !important;
      }
      #qr-reader__scan_region {
        display: none !important;
      }
    `;
    document.head.appendChild(styleElement);
    
    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="space-y-6">
          <div 
            ref={scannerContainerRef}
            className="aspect-[4/3] bg-gray-200 rounded-lg overflow-hidden relative"
            onMouseMove={handleMouseMove}
            onTouchMove={handleMouseMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchEnd={handleEnd}
          >
            <div id="qr-reader" className="w-full h-full"></div>
            {renderScanRegion()}
          </div>
          
          {isScanning && showScanControls && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <h3 className="col-span-3 text-center font-medium text-sm">Controles da Área de Leitura</h3>
                
                {/* Controles de posição */}
                <div className="col-span-3">
                  <h4 className="text-xs font-medium text-center mb-1">Posição</h4>
                  <div className="grid grid-cols-3 gap-1">
                    <div className="col-start-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={moveUp}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="col-start-1 col-end-4 grid grid-cols-3 gap-1 mt-1">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={moveLeft}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={resetScanRegion}
                      >
                        Centralizar
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={moveRight}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="col-start-2 mt-1">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={moveDown}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Controles de tamanho */}
                <div className="col-span-3 mt-2">
                  <h4 className="text-xs font-medium text-center mb-1">Tamanho</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs block text-center">Largura</label>
                      <div className="flex space-x-1">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={decreaseWidth}
                        >
                          -
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={increaseWidth}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs block text-center">Altura</label>
                      <div className="flex space-x-1">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={decreaseHeight}
                        >
                          -
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={increaseHeight}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Botões de ajuste rápido */}
                <div className="col-span-3 flex space-x-2 mt-1">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={shrinkScanRegion}
                  >
                    <Minimize className="h-4 w-4 mr-1" />
                    Reduzir
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={expandScanRegion}
                  >
                    <Maximize className="h-4 w-4 mr-1" />
                    Expandir
                  </Button>
                </div>
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Digite o texto do QR Code"
              value={targetQRCode}
              onChange={(e) => setTargetQRCode(e.target.value)}
              className="w-full"
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Usar lanterna</span>
              <Switch
                checked={useFlash}
                onCheckedChange={setUseFlash}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Selecionar câmera</label>
              <Select value={selectedCamera} onValueChange={setSelectedCamera}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma câmera" />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((camera) => (
                    <SelectItem key={camera.deviceId} value={camera.deviceId || "default"}>
                      {camera.label || `Câmera ${camera.deviceId.slice(0, 5)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Velocidade do Timelapse</label>
              <Select 
                value={timelapseSpeed.toString()} 
                onValueChange={(value) => setTimelapseSpeed(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a velocidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5x (Lento)</SelectItem>
                  <SelectItem value="1">1x (Normal)</SelectItem>
                  <SelectItem value="2">2x (Rápido)</SelectItem>
                  <SelectItem value="4">4x (Muito Rápido)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isCooldown && (
            <div className="space-y-2">
              <div className="text-sm text-center">
                Aguarde {Math.ceil((100 - cooldownProgress) / 10)} segundos
              </div>
              <Progress value={cooldownProgress} className="w-full" />
            </div>
          )}

          <div className="space-y-3">
            <Button 
              className="w-full"
              onClick={isScanning ? stopScanning : startScanning}
            >
              <Camera className="mr-2 h-4 w-4" />
              {isScanning ? 'Parar Scanner' : 'Iniciar Scanner'}
            </Button>
            
            <Button 
              variant="outline"
              className="w-full"
              onClick={downloadPhotos}
              disabled={photos.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Fotos ({photoCount})
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={createTimelapse}
              disabled={photos.length === 0 || generatingTimelapse}
            >
              <Video className="mr-2 h-4 w-4" />
              {generatingTimelapse ? 'Gerando Timelapse...' : 'Criar Timelapse'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
