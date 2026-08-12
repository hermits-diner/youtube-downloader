!macro customInit
  ; If installation directory exists, remove old files completely before install
  ${If} ${FileExists} "$INSTDIR\*.*"
    RMDir /r "$INSTDIR"
  ${EndIf}
!macroend

!macro customInstall
  ; Ensure clean installation folder
!macroend
