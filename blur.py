import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# detect tangan - pakai MediaPipe Tasks API (baru)
base_options = python.BaseOptions(model_asset_path='hand_landmarker.task')
options = vision.HandLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.VIDEO,
    num_hands=1,
    min_hand_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

landmarker = vision.HandLandmarker.create_from_options(options)


def finger_up(tip, pip, landmarks):
    return landmarks[tip].y < landmarks[pip].y


def is_peace(landmarks):

    index_up = finger_up(8, 6, landmarks)
    middle_up = finger_up(12, 10, landmarks)

    ring_up = finger_up(16, 14, landmarks)
    pinky_up = finger_up(20, 18, landmarks)

    return (
        index_up
        and middle_up
        and not ring_up
        and not pinky_up
    )

# open camera
cap = cv2.VideoCapture(0)

frame_timestamp_ms = 0

while True:

    success, frame = cap.read()

    if not success:
        break

    frame = cv2.flip(frame, 1)

    rgb = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )

    # convert ke MediaPipe Image format
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    # detect hands pakai VIDEO mode (butuh timestamp)
    frame_timestamp_ms += 33  # ~30fps
    hand_result = landmarker.detect_for_video(mp_image, frame_timestamp_ms)

    peace_detected = False

    if hand_result.hand_landmarks:

        for hand_landmarks in hand_result.hand_landmarks:

            if is_peace(hand_landmarks):
                peace_detected = True
                break

    # blur efek

    if peace_detected:

        frame = cv2.GaussianBlur(
            frame,
            (61, 61),
            0
        )

    cv2.imshow(
        "Peace Blur",
        frame
    )

    if cv2.waitKey(1) & 0xFF == 27:
        break

cap.release()
cv2.destroyAllWindows()
landmarker.close()
