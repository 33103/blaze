import { h, createRef } from 'preact';
import download from 'downloadjs';
import { route } from 'preact-router';
import { PureComponent } from 'preact/compat';
import { ArrowLeft, CheckCircle, Plus, Image, Film, Box, Music, File } from 'preact-feather';

import Fab from '../../../components/Fab/Fab';
import Modal from '../../../components/Modal/Modal';
import FileDrop from '../../../components/FileDrop/FileDrop';
import { toast } from '../../../components/Toast';

import SocketConnect from '../../../utils/socketConnect';
import Visualizer from '../../../utils/visualizer';
import formatSize from '../../../utils/formatSize';
import constants from '../../../../constants';

import './FileTransfer.scss';

class FileTransfer extends PureComponent {
  
  constructor(props) {
    super(props);
    const { room } = props;
    const savedData = JSON.parse(localStorage.getItem('blaze'));
    this.client = {
      ...savedData.user,
      room,
    };
    
    this.state = {
      percentage: null,
      peers: [],
      isP2P: true,
      files: [],
      errorModal: {
        isOpen: false,
        message: '',
      }
    };
    
    this.canvas = createRef();
    this.fileInput = createRef();

    /**
     * Add the current room in recent rooms list
     */
    if (!savedData.rooms.includes(room)) {
      localStorage.setItem('blaze', JSON.stringify({
        ...savedData,
        rooms: [
          room,
          ...savedData.rooms,
        ],
      }));
    }
  }

  get isSelectorEnabled() {
    return this.state.percentage === null ? (this.state.peers.length - 1 > 0) : false;
  }

  onUserJoin(users) {
    let isP2P = this.state.isP2P;

    users.forEach(user => {
      if (user.name === this.client.name) return;

      isP2P = isP2P && !!user.peerId;
      this.visualizer.addNode({
        name: user.name,
        peerId: user.peerId,
      });
    });

    this.setState({
      peers: users.map(user => user.name),
      isP2P,
    });
  }

  onUserLeave(user) {
    this.visualizer.removeNode(user);
    this.setState({
      peers: this.state.peers.filter(peer => peer !== user),
    });
  }


  /**
   * DOM is reset to prepare for the next file transfer
   */
  resetState() {
    this.visualizer.stopSharing();
    this.setState({
      percentage: null,
      files: this.state.files.map(file => {
        file.sent = true;
        return file;
      }),
    });

    // Remove the file from the input
    this.fileInput.current.value = '';
  }

  selectFiles(inputFiles) {

    /**
     * Firefox for mobile has issue with selection of multiple files.
     * Only one file gets selected and that has '0' size. This is
     * checked here before proceeding to transfer the invalid file.
     */
    if (inputFiles[0].size === 0) {
      toast('Multiple files not supported on this browser');
      return;
    }

    /**
     * Start sending files
     */
    this.fileShare
      .sendFiles({
        numPeers: this.state.peers.length,
        input: inputFiles,
        useTorrent: this.state.isP2P,

        onMeta: (metaData) => {
          metaData = metaData.map(file => ({
            ...file,
            sentTo: this.state.peers.slice(1),
          }));

          this.setState({
            files: [...metaData, ...this.state.files],
          });
        },
        onTorrentProgress: ({ wires }) => {
          this.visualizer.startSharing(
            wires
              .filter(wire => wire.uploadSpeed())
              .map(wire => wire.peerId),
            []
          );
        },
        onSocketProgress: ({ progress }) => {
          const percentage = progress * 100;
          this.setState({ percentage });
          this.visualizer.startSharing();

          if (percentage >= 100) {
            this.resetState();
          }
        },
        onDone: () => {
          this.setState({
            files: this.state.files.map(file => ({ ...file, sent: true })),
          });
          this.visualizer.stopSharing();
          this.resetState();
        },
      });
  }

  componentDidMount() {
    this.visualizer = new Visualizer(this.canvas.current);
    this.fileShare = new SocketConnect(this.client.room, this.client.name);
    const { socket } = this.fileShare;

    this.visualizer.addNode({
      name: this.client.name,
      isClient: true,
    });

    socket.listen(constants.USER_JOIN, this.onUserJoin.bind(this));
    socket.listen(constants.USER_LEAVE, this.onUserLeave.bind(this));
    socket.on('close', data => {
      this.setState({
        errorModal: {
          isOpen: true,
          message: data.reason,
        },
      });
    });


    this.fileShare.receiveFiles({
      onMeta: (data) => {
        this.sender = data.sender;
        data.meta.forEach(file => {
          file.sentBy = data.sender;
        });

        this.setState({
          files: [...data.meta, ...this.state.files],
        });
      },
      onProgress: ({ progress, wires }) => {
        const receivedBy = [];
        const sentTo = [];

        if (wires !== undefined) {
          wires.forEach(wire => {
            if (wire.uploadSpeed()) {
              sentTo.push(wire.peerId);
            } else if (wire.downloadSpeed()) {
              receivedBy.push(wire.peerId);
            }
          });
        }
        else {
          receivedBy.push(this.sender);
        }

        this.visualizer.startSharing(sentTo, receivedBy);
        this.setState({
          percentage: progress * 100,
        });
      },
      onDone: (file, meta) => {
        if (file !== undefined) {
          if (Array.isArray(file)) {
            file.forEach(file => {
              file.getBlob((err, blob) => download(blob, file.name));
            });
          }
          else {
            download(file, meta.name, meta.type);
          }
        }
        this.resetState();
      },
    });
  }

  handleNewRoom() {
    this.setState({
      errorModal: {
        isOpen: false,
      },
    });

    route('/app', true);
  }

  componentWillUnmount() {
    this.fileShare.socket.close();
  }

  renderFileIcon(file) {
    const size = 20;

    switch (file.type.split('/')[0]) {
      case 'image':
        return <Image size={size} />;
      case 'video':
        return <Film size={size} />;
      case 'audio':
        return <Music size={size} />;
      case 'application':
        return <Box size={size} />;
      default:
        return <File size={size} />;
    }
  }

  render({ room }, { percentage, peers, isP2P, files, errorModal }) {

    return (
      <div class="file-transfer">
        <header class="app-header">
          <button
            class="thin icon left"
            aria-label="Go back"
            onClick={() => window.history.back()}
          >
            <ArrowLeft />
          </button>

          <h1 class="room-name">
            {room}
          </h1>

          {/* <!-- Fake element to correct the flex spacing --> */}
          <button class="thin icon right" style="visibility: hidden" />
        </header>

        <main>

          <div>
            <canvas ref={this.canvas} style="margin-left: -0.6rem" />

            {
              percentage !== null && (
                <div class="transfer-percentage">
                  {Math.floor(percentage)}%
                </div>
              )
            }

            <div class="transfer-tech">
              {
                peers.length <= 1 ? 'Waiting for other devices to join same room'
                : isP2P === true ? 'Established a P2P connection'
                : 'Using an intermediate server'
              }
            </div>
          </div>


          <input
            ref={this.fileInput}
            type="file"
            hidden
            onChange={e => this.selectFiles(e.target.files)}
            multiple
          />

          {
            !!files.length && (
              <div class="card files-container">
                <div class="header">
                  <h2>Files</h2>
                </div>
                <ul class="files">

                  {
                    files.map(file => (
                      <li>
                        <div class="file-type">
                          {this.renderFileIcon(file)}
                        </div>
                        <div class="info">
                          <h4>{file.name}</h4>
                          <p>
                            {formatSize(file.size)}
                            {!!file.sentBy && ` | Sent by ${file.sentBy}`}
                            {!!file.sentTo && ` | You sent to ${file.sentTo.join(', ')}`}
                          </p>
                        </div>

                        {
                          file.sent ? (
                            <div class="file-complete">
                              <CheckCircle />
                            </div>
                          ) : (
                            <svg width="30" height="30" class="file-progress">
                              <circle cx="15" cy="15" r="10" style={`stroke-dashoffset:${63 * percentage/100 - 63}`} />
                            </svg>
                          )
                        }
                      </li>
                    ))
                  }

                </ul>
              </div>
            )
          }

          <Fab text="Send File" disabled={!this.isSelectorEnabled} onClick={() => this.fileInput.current.click()}>
            <Plus />
          </Fab>

        </main>

        <Modal isClosable={false} isOpen={errorModal.isOpen}>
          <div class="socket-error">
            <h2>Connection Error!</h2>

            <p class="message">
              {errorModal.message}
            </p>

            <button class="wide" onClick={() => this.handleNewRoom()}>
              Select new room
            </button>
          </div>
        </Modal>

        { this.isSelectorEnabled && <FileDrop onFile={files => this.selectFiles(files)} /> }
      </div>
    );
  }
}

export default FileTransfer;