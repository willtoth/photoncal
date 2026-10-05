import java.nio.file.*;
import java.lang.reflect.*;

/** Offline compatibility check against the actual PhotonVision Java importer.
 * It never starts PhotonVision, opens a camera, or changes its configuration. */
public class PhotonVisionImport {
  public static void main(String[] args) throws Exception {
    Class<?> coefficients=Class.forName("org.photonvision.vision.calibration.CameraCalibrationCoefficients");
    Class<?> importer=Class.forName("org.photonvision.common.util.file.JacksonUtils");
    Object calibration=importer.getMethod("deserialize",String.class,Class.class)
      .invoke(null,Files.readString(Path.of(args[0])),coefficients);
    Field size;
    try { size=coefficients.getField("resolution"); }
    catch(NoSuchFieldException e) { size=coefficients.getField("unrotatedImageSize"); }
    Object resolution=size.get(calibration);
    if(resolution.getClass().getField("width").getDouble(resolution)!=1280)throw new AssertionError("Resolution did not import");
    Object k=coefficients.getField("cameraIntrinsics").get(calibration),d=coefficients.getField("distCoeffs").get(calibration);
    double[] intrinsics=(double[])k.getClass().getField("data").get(k),distortion=(double[])d.getClass().getField("data").get(d);
    if(intrinsics.length!=9||distortion.length!=8||intrinsics[0]<=0||intrinsics[8]!=1)throw new AssertionError("Invalid matrices");
    if(!coefficients.getField("lensmodel").get(calibration).toString().equals("LENSMODEL_OPENCV"))throw new AssertionError("Wrong lens model");
    System.out.println("Actual PhotonVision Java importer accepted the browser export: 1280px, fx="+intrinsics[0]+", 8 distortion coefficients.");
  }
}
